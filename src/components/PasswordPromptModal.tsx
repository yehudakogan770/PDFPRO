import { useState } from 'react'
import type { FormEvent } from 'react'
import { IconLock } from './Icons'

interface PasswordPromptModalProps {
  fileName: string
  wrongPassword: boolean
  isChecking: boolean
  remaining: number
  onSubmit: (password: string) => void
  onSkip: () => void
}

export function PasswordPromptModal({ fileName, wrongPassword, isChecking, remaining, onSubmit, onSkip }: PasswordPromptModalProps) {
  const [password, setPassword] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (password && !isChecking) onSubmit(password)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="password-title" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center gap-2">
          <IconLock className="size-5 text-slate-500" />
          <h2 id="password-title" className="text-base font-semibold text-slate-900">
            Password required
          </h2>
        </div>
        <p className="mt-2 truncate text-sm text-slate-500" title={fileName}>
          {fileName}
        </p>
        {wrongPassword && <p className="mt-2 text-sm text-red-600">Incorrect password — try again.</p>}
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          <div className="mt-4 flex items-center justify-between gap-2">
            {remaining > 0 && <p className="text-xs text-slate-400">{remaining} more locked file{remaining === 1 ? '' : 's'} waiting</p>}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={onSkip} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
                Skip this file
              </button>
              <button
                type="submit"
                disabled={!password || isChecking}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isChecking ? 'Checking…' : 'Unlock'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
