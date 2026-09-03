import { createContext, useContext, useMemo, type ReactNode } from 'react'

import type { AppGateway } from './appGateway'
import { TauriAppGateway } from './tauriAppGateway'

const GatewayContext = createContext<AppGateway | null>(null)

export interface GatewayProviderProps {
  children: ReactNode
  /** Override the gateway implementation. Defaults to the production Tauri bridge. */
  gateway?: AppGateway
}

/**
 * Provides a single typed `AppGateway` to the React tree.
 *
 * Production uses `TauriAppGateway` (the only module allowed to import
 * `@tauri-apps/api/core`). Tests pass a `FakeAppGateway` to avoid the Tauri
 * runtime and to inject failures deterministically.
 */
export function GatewayProvider({ children, gateway }: GatewayProviderProps) {
  const instance = useMemo(() => gateway ?? new TauriAppGateway(), [gateway])
  return <GatewayContext.Provider value={instance}>{children}</GatewayContext.Provider>
}

/**
 * Access the application gateway. Must be called inside a `<GatewayProvider>`.
 */
export function useAppGateway(): AppGateway {
  const gateway = useContext(GatewayContext)
  if (!gateway) {
    throw new Error('useAppGateway must be used within a <GatewayProvider>')
  }
  return gateway
}
