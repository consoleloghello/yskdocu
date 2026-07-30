/**
 * decompress.js — Browser-side decompression utility.
 *
 * 提供 window.Decompress 工具，使用浏览器原生 DecompressionStream API
 * 获取并解压 gzip 压缩的 JSON 数据文件 (.json.gz)，
 * 自动降级到未压缩的 .json 文件。
 *
 * 使用 gzip 而非 Brotli 的原因：DecompressionStream('gzip') 在支持
 * DecompressionStream 的所有浏览器中均可使用，而 'br' (Brotli) 格式
 * 需要较新版本的浏览器（Chrome 114+, Firefox 119+, Safari 17.0+）。
 * gzip 仅比 Brotli 大约 3%，但兼容性更广。
 *
 * 浏览器兼容性: Chrome 95+, Firefox 113+, Safari 16.4+
 *
 * 用法:
 *   const data = await Decompress.fetchJSON('data/外操版');
 *   // → 尝试 data/外操版.json.gz，解压后返回解析的 JSON 对象
 *   // → 如果 .gz 文件不存在，降级到 data/外操版.json
 */

(function () {
  'use strict';

  const Decompress = {};

  /**
   * 获取并解压 gzip 压缩的 JSON 文件，返回解析后的对象
   *
   * @param {string} basePath - 不带扩展名的路径 (如 'data/外操版')
   * @returns {Promise<object>} 解析后的 JSON 数据
   */
  Decompress.fetchJSON = async function (basePath) {
    // 先尝试 gzip 压缩版本
    const gzPath = basePath + '.json.gz';
    try {
      const response = await fetch(gzPath);
      if (response.ok) {
        try {
          return await decompressResponse(response);
        } catch (decompressErr) {
          // 解压失败（如 DecompressionStream 不可用）— 降级
          console.warn('Decompress: gzip decompression failed, falling back to .json —', decompressErr.message);
        }
      }
    } catch (e) {
      // 网络错误 — 降级到未压缩文件
      console.warn('Decompress: .gz fetch failed, falling back to .json —', e.message);
    }

    // 降级：加载未压缩的 JSON
    const jsonPath = basePath + '.json';
    const fallbackResp = await fetch(jsonPath);
    if (!fallbackResp.ok) {
      throw new Error('Decompress: failed to load ' + jsonPath + ' (HTTP ' + fallbackResp.status + ')');
    }
    return await fallbackResp.json();
  };

  /**
   * 解压 gzip 压缩的 Response 并解析为 JSON
   *
   * @param {Response} response - gzip 压缩的 fetch 响应
   * @returns {Promise<object>} 解析后的 JSON 数据
   */
  async function decompressResponse(response) {
    // 检查 DecompressionStream 是否可用
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream API not supported');
    }

    // 验证 'gzip' 格式是否被支持（某些旧浏览器支持 API 但不支持所有格式）
    try {
      // 快速探针：尝试构造一个 DecompressionStream 实例检测格式支持
      new DecompressionStream('gzip');
    } catch (formatErr) {
      throw new Error('Compression format gzip not supported: ' + formatErr.message);
    }

    // 获取 Response 的 ReadableStream
    let body = response.body;
    if (!body) {
      // 降级：某些浏览器或 CORS 模式下 body 为 null
      // 通过 arrayBuffer → Blob → stream 的路径间接获取可读流
      const buffer = await response.arrayBuffer();
      const blob = new Blob([buffer]);
      body = blob.stream();
    }

    // 通过 gzip 解压管道
    const decompressedStream = body.pipeThrough(new DecompressionStream('gzip'));

    // 读取解压后的流为文本
    const reader = decompressedStream.getReader();
    const chunks = [];
    let totalLength = 0;

    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      chunks.push(result.value);
      totalLength += result.value.length;
    }

    // 合并所有 Uint8Array 块为连续缓冲区
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      merged.set(chunks[i], offset);
      offset += chunks[i].length;
    }

    // 使用 TextDecoder 解码为 UTF-8 文本再解析 JSON
    // 比多次拼接字符串更高效
    const text = new TextDecoder().decode(merged);
    return JSON.parse(text);
  }

  window.Decompress = Decompress;
})();
