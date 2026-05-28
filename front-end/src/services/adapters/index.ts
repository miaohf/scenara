/**
 * 模型适配器统一导出
 */

export * from './chatAdapter';
export {
  callImageApi,
  isAspectRatioSupported as isImageAspectRatioSupported,
} from './imageAdapter';
export {
  callVideoApi,
  isAspectRatioSupported as isVideoAspectRatioSupported,
  isDurationSupported,
} from './videoAdapter';
