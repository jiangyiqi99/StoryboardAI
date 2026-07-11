import { createRequire } from "node:module";
import { join } from "node:path";
import type { NativeVideoFrame } from "@shared/types/native-media";

interface SharedMemoryBridgeAddon {
  isAvailable(): boolean;
  map(name: string, byteLength: number): SharedArrayBuffer;
}

interface WebglFramePresenter {
  draw(frame: NativeVideoFrame, pixels: Uint8Array): void;
  resize(width: number, height: number): void;
}

const require = createRequire(import.meta.url);

/**
 * Runs in the preload world so Electron IPC only carries a small lease
 * descriptor. The OS mapping and WebGL upload stay inside the renderer
 * process, which avoids serializing a video frame through main IPC.
 */
export class NativeFramePresenter {
  private readonly bridge = loadSharedMemoryBridge();
  private readonly renderers = new WeakMap<HTMLCanvasElement, WebglFramePresenter>();

  constructor(private readonly releaseLease: (leaseId: string) => Promise<unknown>) {}

  async present(canvasId: string, frame: NativeVideoFrame): Promise<void> {
    if (frame.data.kind !== "shared-memory") return;
    if (frame.format !== "rgba") {
      throw new Error(`WebGL native preview only supports RGBA shared frames, received ${frame.format}.`);
    }
    if (!this.bridge) {
      throw new Error("Native preview shared-memory bridge is unavailable in preload.");
    }
    const canvas = document.getElementById(canvasId);
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error(`Native preview canvas was not found: ${canvasId}`);
    }
    const plane = frame.planes[0];
    if (!plane || plane.byteLength > frame.data.byteLength) {
      throw new Error("Native preview shared frame has an invalid pixel plane.");
    }
    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      canvas.width = frame.width;
      canvas.height = frame.height;
      this.renderers.get(canvas)?.resize(frame.width, frame.height);
    }

    const renderer = this.renderers.get(canvas) ?? createWebglFramePresenter(canvas);
    if (!renderer) {
      throw new Error("WebGL2 is unavailable for native preview.");
    }
    this.renderers.set(canvas, renderer);
    const buffer = this.bridge.map(frame.data.name, frame.data.byteLength);
    renderer.draw(frame, new Uint8Array(buffer, plane.offset, plane.byteLength));
    try {
      await this.releaseLease(frame.data.leaseId);
    } catch {
      // The sidecar also cleans remaining leases on session shutdown.
    }
  }
}

function loadSharedMemoryBridge(): SharedMemoryBridgeAddon | undefined {
  if (process.platform === "win32") return undefined;
  const roots = process.resourcesPath ? [process.resourcesPath, process.cwd()] : [process.cwd()];
  for (const root of roots) {
    try {
      const bridge = require(
        join(root, "native", "shared-memory-bridge", "bin", "frame-shared-memory-bridge.node")
      ) as SharedMemoryBridgeAddon;
      if (bridge.isAvailable()) return bridge;
    } catch {
      // The main process will select inline transport when its matching bridge is absent.
    }
  }
  return undefined;
}

function createWebglFramePresenter(canvas: HTMLCanvasElement): WebglFramePresenter | undefined {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    desynchronized: true,
    preserveDrawingBuffer: false
  });
  if (!gl) return undefined;
  const vertex = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `#version 300 es
      in vec2 aPosition;
      out vec2 vUv;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
        vUv = vec2((aPosition.x + 1.0) * 0.5, 1.0 - (aPosition.y + 1.0) * 0.5);
      }`
  );
  const fragment = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `#version 300 es
      precision mediump float;
      uniform sampler2D uFrame;
      in vec2 vUv;
      out vec4 outColor;
      void main() { outColor = texture(uFrame, vUv); }`
  );
  const program = gl.createProgram();
  const texture = gl.createTexture();
  const vertexBuffer = gl.createBuffer();
  if (!vertex || !fragment || !program || !texture || !vertexBuffer) return undefined;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return undefined;

  const position = gl.getAttribLocation(program, "aPosition");
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, "uFrame"), 0);

  const resize = (width: number, height: number) => gl.viewport(0, 0, width, height);
  resize(canvas.width, canvas.height);
  return {
    resize,
    draw: (frame, pixels) => {
      gl.viewport(0, 0, frame.width, frame.height);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, frame.stride === frame.width * 4 ? 0 : frame.stride / 4);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        frame.width,
        frame.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels
      );
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  };
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | undefined {
  const shader = gl.createShader(type);
  if (!shader) return undefined;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : undefined;
}
