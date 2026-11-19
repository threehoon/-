import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/app.css'

const container = document.getElementById('root')
if (container === null) {
  throw new Error('页面缺少 #root 挂载点，无法启动工作台。')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
