import { useEffect, useRef, useState } from 'react'
import { DEEPSEEK_API, DEEPSEEK_MODELS, deepSeekPageAllowed, requestDeepSeek, validDeepSeekKey, type DeepSeekConfig } from './deepseek-check'
import { saveRememberedDeepSeekConfig } from './deepseek-config-store'

interface SettingsProps {
  readonly config: DeepSeekConfig | null
  readonly remembered: boolean
  readonly onSave: (config: DeepSeekConfig | null, remembered: boolean) => void
  readonly onClose: () => void
}

export function DeepSeekSettings({ config, remembered, onSave, onClose }: SettingsProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const request = useRef<AbortController | null>(null)
  const [key, setKey] = useState(config?.key ?? '')
  const [model, setModel] = useState(config?.model ?? DEEPSEEK_MODELS[0])
  const [tested, setTested] = useState(config !== null)
  const [consent, setConsent] = useState(config !== null)
  const [status, setStatus] = useState('')
  const [testing, setTesting] = useState(false)
  const [remember, setRemember] = useState(remembered)
  const keyValid = validDeepSeekKey(key.trim())
  const allowed = deepSeekPageAllowed()

  function applySettings(next: DeepSeekConfig | null) {
    const persist = next !== null && remember
    if (!saveRememberedDeepSeekConfig(persist ? next : null) && (persist || remembered)) {
      setStatus(persist
        ? '浏览器未能保存配置。请允许站点存储后重试，或取消勾选记住配置。'
        : '浏览器未能清除保存的配置。请重试，或在浏览器设置中管理此站点的数据。')
      return
    }
    onSave(next, persist)
  }

  useEffect(() => {
    const modal = dialog.current
    const trigger = document.activeElement
    modal?.showModal()
    return () => {
      request.current?.abort()
      modal?.close()
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [])

  async function testConnection() {
    if (!keyValid || !allowed || request.current) return
    const controller = new AbortController()
    request.current = controller
    setTested(false)
    setTesting(true)
    setStatus('正在向 DeepSeek 发送固定测试样例…')
    try {
      await requestDeepSeek({ key: key.trim(), model }, null, controller.signal)
      if (controller.signal.aborted) return
      setTested(true)
      setStatus('连接成功。测试没有发送你的稿件。')
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : '连接未完成，请重试。')
    } finally {
      if (request.current === controller) request.current = null
      if (!controller.signal.aborted) setTesting(false)
    }
  }

  function invalidate() {
    setTested(false)
    setStatus('')
  }

  return (
    <dialog ref={dialog} className="ai-settings" aria-labelledby="ai-settings-title" onCancel={(event) => {
      event.preventDefault()
      onClose()
    }} onKeyDown={(event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.stopPropagation()
    }}>
      <form autoComplete="off" onSubmit={(event) => {
        event.preventDefault()
        if (keyValid && allowed && tested && consent && !testing) applySettings({ key: key.trim(), model })
      }}>
        <h2 id="ai-settings-title">DeepSeek 校对设置</h2>
        <p>只连接 DeepSeek 官方服务。测试连接可能产生少量 API 用量。</p>
        <div className="field">
          <label className="field__label" htmlFor="deepseek-api">API 地址（固定）</label>
          <input className="field__input" id="deepseek-api" value={DEEPSEEK_API} readOnly />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="deepseek-model">模型</label>
          <select className="field__input" id="deepseek-model" value={model} disabled={testing} onChange={(event) => {
            const next = DEEPSEEK_MODELS.find((entry) => entry === event.currentTarget.value)
            if (next) {
              setModel(next)
              invalidate()
            }
          }}>
            <option value={DEEPSEEK_MODELS[0]}>DeepSeek Flash（默认）</option>
            <option value={DEEPSEEK_MODELS[1]}>DeepSeek V4 Pro</option>
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="deepseek-key">API Key</label>
          <input className="field__input" id="deepseek-key" type="password" autoFocus autoComplete="off" spellCheck={false}
            value={key} maxLength={256} disabled={!allowed || testing} aria-describedby="deepseek-key-help"
            onChange={(event) => { setKey(event.currentTarget.value); invalidate() }} />
          <p id="deepseek-key-help">没有 Key？<a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">在 DeepSeek 开放平台创建</a>。</p>
        </div>
        <label className="ai-settings__consent">
          <input type="checkbox" checked={consent} disabled={!allowed || testing}
            onChange={(event) => setConsent(event.currentTarget.checked)} />
          <span>我同意仅在点击「AI 检查内容」时，将当前平台标题和正文纯文本发送给 DeepSeek。不发送图片、附件或原始 Markdown。</span>
        </label>
        <label className="ai-settings__consent">
          <input type="checkbox" checked={remember} disabled={!allowed || testing} aria-describedby="deepseek-remember-help"
            onChange={(event) => { setRemember(event.currentTarget.checked); setStatus('') }} />
          <span>在此浏览器记住配置</span>
        </label>
        <p id="deepseek-remember-help">勾选后，Key 和模型会保存在此站点的浏览器数据中，重开不用填写。Key 不加密，请勿在共用设备上勾选。</p>
        <p className="ai-settings__status" role="status">{allowed ? status : '当前网页不是安全页面。请用 HTTPS 或本机地址打开后再配置。'}</p>
        <div className="ai-settings__actions">
          {config ? <button className="btn btn--ghost" type="button" onClick={() => applySettings(null)}>清除配置</button> : null}
          <button className="btn btn--ghost" type="button" onClick={onClose}>取消</button>
          <button className="btn btn--secondary" type="button" disabled={!allowed || !keyValid || testing}
            onClick={() => { void testConnection() }}>测试连接</button>
          <button className="btn btn--primary" type="submit" disabled={!allowed || !keyValid || !tested || !consent || testing}>启用 DeepSeek</button>
        </div>
      </form>
    </dialog>
  )
}
