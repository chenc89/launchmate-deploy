import { mapShareUrl } from './shareUrlAdapter.js';

// 保留应用的脚本原字节，只在本次网页运行时转换已选定的本机地址。
function installShareAdapter(config, mapUrl) {
  const route = (value) => mapUrl(value, config, window.document?.baseURI || window.location.href);
  const nativeFetch = window.fetch;
  window.fetch = async function (input, init) {
    const source = input instanceof Request ? input.url : String(input);
    const mapped = route(source);
    if (mapped === source) return nativeFetch.call(this, input, init);
    const address = new URL(mapped, window.location.href).href;
    if (input instanceof Request) return nativeFetch.call(this, new Request(address, new Request(input, init)));
    return nativeFetch.call(this, address, init);
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    return nativeOpen.call(this, method, route(url), ...rest);
  };

  const attributes = new Set(['src', 'href', 'action', 'formaction', 'poster']);
  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    return nativeSetAttribute.call(this, name, attributes.has(String(name).toLowerCase()) ? route(value) : value);
  };
  for (const [name, properties] of Object.entries({ HTMLImageElement: ['src'], HTMLScriptElement: ['src'], HTMLLinkElement: ['href'], HTMLAnchorElement: ['href'], HTMLMediaElement: ['src'], HTMLSourceElement: ['src'], HTMLIFrameElement: ['src'], HTMLFormElement: ['action'], HTMLInputElement: ['src', 'formAction'], HTMLButtonElement: ['formAction'], HTMLVideoElement: ['poster'] })) {
    const prototype = window[name]?.prototype;
    if (!prototype) continue;
    for (const property of properties) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (!descriptor?.set || !descriptor.configurable) continue;
      Object.defineProperty(prototype, property, { ...descriptor, set(value) { descriptor.set.call(this, route(value)); } });
    }
  }
}

export function shareBrowserScript(config) {
  return `(${installShareAdapter.toString()})(${JSON.stringify(config)}, ${mapShareUrl.toString()});\n`;
}
