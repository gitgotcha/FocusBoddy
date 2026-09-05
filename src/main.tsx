import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { GatewayProvider } from './services/gatewayContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Outside GatewayProvider on purpose: a failure in the provider itself
        must surface as a readable error, not as an empty black window. */}
    <ErrorBoundary>
      <GatewayProvider>
        <App />
      </GatewayProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
