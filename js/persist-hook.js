/* 本地保存后的唯一出口：已登录云账号就上传账号云，否则才走 Gist。 */

import { setAfterSave } from './store.js'

let cloudLoggedIn = () => false
let cloudNote = () => {}
let gistNote = () => {}
let installed = false

export function registerCloudSaver(isLoggedIn, note) {
  cloudLoggedIn = isLoggedIn
  cloudNote = note
}

export function registerGistSaver(note) {
  gistNote = note
}

export function installPersistHook() {
  if (installed) return
  installed = true
  setAfterSave(() => {
    if (cloudLoggedIn()) cloudNote()
    else gistNote()
  })
}
