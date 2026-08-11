import { IconAlertCircle, IconX } from './Icons'

export interface ImportIssue {
  id: string
  message: string
}

interface ImportIssuesProps {
  issues: ImportIssue[]
  onDismiss: (id: string) => void
  onDismissAll: () => void
}

export function ImportIssues({ issues, onDismiss, onDismissAll }: ImportIssuesProps) {
  if (issues.length === 0) return null

  return (
    <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <IconAlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-amber-900">{issues.length === 1 ? '1 issue' : `${issues.length} issues`}</p>
            <ul className="space-y-0.5 text-sm text-amber-800">
              {issues.map((issue) => (
                <li key={issue.id} className="flex items-center gap-2">
                  <span>{issue.message}</span>
                  <button
                    type="button"
                    onClick={() => onDismiss(issue.id)}
                    className="text-amber-500 hover:text-amber-700"
                    aria-label="Dismiss"
                  >
                    <IconX className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {issues.length > 1 && (
          <button type="button" onClick={onDismissAll} className="shrink-0 text-xs font-medium text-amber-700 hover:text-amber-900">
            Dismiss all
          </button>
        )}
      </div>
    </div>
  )
}
