/* SPDX-License-Identifier: MPL-2.0
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * © Copyright 2026 Technical University of Denmark
 * Lead developer: Leonardo Ferhati
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logEvent } from '../stores/logStore'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logEvent({
      level: 'error',
      source: 'frontend',
      module: 'ErrorBoundary',
      message: error.message,
      stack: (error.stack || '') + (info.componentStack ? '\n\nComponent stack:' + info.componentStack : ''),
    })
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: 40,
          textAlign: 'center',
          color: 'var(--text-primary)',
        }}
      >
        <div style={{ fontSize: 'var(--text-xl)', fontWeight: 600, marginBottom: 12 }}>
          Something went wrong
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', maxWidth: 520, marginBottom: 20, fontFamily: 'var(--font-mono)' }}>
          {this.state.error.message}
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: 20 }}>
          A log entry was recorded. Check <b>Settings → Logs</b> and send it to leo_frht@icloud.com.
        </div>
        <button
          onClick={this.reset}
          style={{
            padding: '8px 16px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-default)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>
    )
  }
}
