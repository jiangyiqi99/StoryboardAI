#include <node.h>
#include <v8.h>

#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

#include <cstdint>
#include <memory>
#include <string>

namespace {

void release_mapping(void* data, size_t length, void*) {
  if (data != nullptr && length > 0) {
    munmap(data, length);
  }
}

void throw_error(v8::Isolate* isolate, const char* message) {
  isolate->ThrowException(v8::Exception::Error(
      v8::String::NewFromUtf8(isolate, message).ToLocalChecked()));
}

void is_available(const v8::FunctionCallbackInfo<v8::Value>& args) {
  args.GetReturnValue().Set(v8::Boolean::New(args.GetIsolate(), true));
}

void map_shared_memory(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto* isolate = args.GetIsolate();
  const auto context = isolate->GetCurrentContext();
  if (args.Length() != 2 || !args[0]->IsString() || !args[1]->IsNumber()) {
    return throw_error(isolate, "map(name, byteLength) requires a string and a positive number.");
  }

  v8::String::Utf8Value name(isolate, args[0]);
  const auto signed_length = args[1]->IntegerValue(context).FromMaybe(0);
  if (*name == nullptr || signed_length <= 0) {
    return throw_error(isolate, "Shared-memory lease parameters are invalid.");
  }
  const auto byte_length = static_cast<size_t>(signed_length);

  const int fd = open(*name, O_RDONLY);
  if (fd < 0) {
    return throw_error(isolate, "Unable to open the native preview memory-mapped frame lease.");
  }
  void* mapping = mmap(nullptr, byte_length, PROT_READ, MAP_SHARED, fd, 0);
  close(fd);
  if (mapping == MAP_FAILED) {
    return throw_error(isolate, "Unable to map the native preview memory-mapped frame lease.");
  }

  auto backing_store = v8::SharedArrayBuffer::NewBackingStore(
      mapping, byte_length, release_mapping, nullptr);
  if (!backing_store) {
    munmap(mapping, byte_length);
    return throw_error(isolate, "Unable to create a backing store for the native preview frame.");
  }
  auto shared_array_buffer = v8::SharedArrayBuffer::New(
      isolate, std::shared_ptr<v8::BackingStore>(std::move(backing_store)));
  args.GetReturnValue().Set(shared_array_buffer);
}

}  // namespace

void initialize(v8::Local<v8::Object> exports,
                v8::Local<v8::Value>,
                v8::Local<v8::Context>,
                void*) {
  NODE_SET_METHOD(exports, "isAvailable", is_available);
  NODE_SET_METHOD(exports, "map", map_shared_memory);
}

NODE_MODULE_CONTEXT_AWARE(NODE_GYP_MODULE_NAME, initialize)
