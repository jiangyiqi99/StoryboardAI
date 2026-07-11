{
  "targets": [
    {
      "target_name": "frame_shared_memory_bridge",
      "sources": ["src/frame_shared_memory_bridge.cc"],
      "cflags_cc": ["-std=c++20"],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
        "CLANG_CXX_LIBRARY": "libc++"
      }
    }
  ]
}
