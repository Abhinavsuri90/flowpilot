import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { encode } from 'uqr'
import { Copy, Download } from 'lucide-react'
import { api, ApiError } from '~/lib/api'
import { saveBlob } from '~/lib/spreadsheet'
import type { SecondStepResult } from '~/lib/types'
import { Button, Callout, Field, Input, useHydrated } from './ui'
import { useToast } from './toast'

// Pieces of two-step sign-in shared by the sign-in, password-reset and account pages.

/**
 * A QR code drawn as one SVG path from the encoder's grid of modules. Always dark
 * on white, whatever the theme: that is what phone cameras read reliably.
 */
export function QrCode({ value, label, size = 184 }: { value: string; label: string; size?: number }) {
  const { path, modules } = React.useMemo(() => {
    const { data } = encode(value, { ecc: 'M', border: 2 })
    let d = ''
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`
      }),
    )
    return { path: d, modules: data.length }
  }, [value])
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${modules} ${modules}`} width={size} height={size} shapeRendering="crispEdges" className="rounded-lg">
      <rect width={modules} height={modules} fill="#ffffff" />
      <path d={path} fill="#0b0d12" />
    </svg>
  )
}

/** The setup key in groups of four, which is how people copy it into an app by hand. */
export const groupKey = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim()

/**
 * The second step of signing in: a 6-digit code from the app, or a recovery code.
 * An expired or used-up challenge sends the person back to the password step.
 */
export function SecondStepForm({
  challenge,
  onSignedIn,
  onRestart,
}: {
  challenge: string
  onSignedIn: (result: SecondStepResult) => void | Promise<void>
  onRestart: (message?: string) => void
}) {
  const hydrated = useHydrated()
  const [recovery, setRecovery] = React.useState(false)
  const [code, setCode] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const verify = useMutation({
    mutationFn: (value: string) => api.post<SecondStepResult>('/api/auth/two-factor', { challenge, code: value }),
    onSuccess: onSignedIn,
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'CHALLENGE_EXPIRED') {
        onRestart(err.message)
        return
      }
      setCode('')
      inputRef.current?.focus()
    },
  })
  const compact = code.replace(/[\s-]/g, '')
  const ready = recovery ? compact.length === 10 : /^\d{6}$/.test(compact)
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (ready && !verify.isPending) verify.mutate(code.trim())
  }
  const switchMode = () => {
    setRecovery((r) => !r)
    setCode('')
    verify.reset()
    inputRef.current?.focus()
  }

  return (
    <form onSubmit={submit} method="post" className="mt-7 space-y-4" noValidate>
      <Field
        label={recovery ? 'Recovery code' : 'Code from your authenticator app'}
        htmlFor="two-factor-code"
        hint={
          recovery
            ? 'One of the ten codes you saved when you turned on two-step sign-in. Each one works once.'
            : 'Open your authenticator app and enter the 6-digit code shown for FlowPilot.'
        }
      >
        <Input
          id="two-factor-code"
          ref={inputRef}
          value={code}
          onChange={(e) => {
            const next = recovery ? e.target.value : e.target.value.replace(/[^\d\s]/g, '')
            setCode(next)
            // Six digits are the whole code: send it without another click.
            if (!recovery && /^\d{6}$/.test(next.replace(/\s/g, '')) && !verify.isPending) verify.mutate(next.trim())
          }}
          inputMode={recovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={recovery ? 13 : 7}
          placeholder={recovery ? 'xxxxx-xxxxx' : '123456'}
          className="h-12 text-center font-mono text-[18px] tracking-[0.3em]"
          autoFocus
          disabled={!hydrated}
        />
      </Field>
      {verify.error && (
        <Callout tone="bad" title={verify.error instanceof ApiError && verify.error.status === 429 ? 'Too many attempts' : 'That didn’t work'}>
          {verify.error.message}
        </Callout>
      )}
      <Button type="submit" variant="brand" size="lg" className="w-full" loading={verify.isPending} disabled={!hydrated || !ready}>
        Verify and sign in
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <button type="button" onClick={switchMode} className="font-medium text-brand-ink hover:underline">
          {recovery ? 'Use the code from the app' : 'Use a recovery code'}
        </button>
        <button type="button" onClick={() => onRestart()} className="text-muted hover:text-ink hover:underline">
          Start over
        </button>
      </div>
    </form>
  )
}

/** Recovery codes, shown once: to copy, download, or write down. */
export function RecoveryCodes({ codes, email }: { codes: string[]; email: string }) {
  const toast = useToast()
  const text = `FlowPilot recovery codes for ${email}\nEach code works once. Keep them somewhere safe, such as a password manager.\n\n${codes.join('\n')}\n`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.show({ tone: 'ok', title: 'Recovery codes copied' })
    } catch {
      toast.show({ tone: 'bad', title: 'Could not copy', description: 'Download them, or select and copy them by hand.' })
    }
  }
  return (
    <div className="space-y-3">
      <ol aria-label="Recovery codes" className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-line bg-surface-2 px-5 py-4 font-mono text-[14px] text-ink">
        {codes.map((code) => (
          <li key={code} className="tabular">
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => void copy()}>
          Copy
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<Download className="size-3.5" />}
          onClick={() => saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'flowpilot-recovery-codes.txt')}
        >
          Download
        </Button>
      </div>
    </div>
  )
}
