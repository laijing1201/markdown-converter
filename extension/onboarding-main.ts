/** 首次安装引导页（P4C 第三十三节）：轻量说明 + 平台入口，不注册、不强绑流程。 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

$('btn-open-chatgpt').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://chatgpt.com/' })
  window.close()
})

$('btn-open-deepseek').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://chat.deepseek.com/' })
  window.close()
})
