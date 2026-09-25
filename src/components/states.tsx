import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { Compass, Lock, ServerCrash, ShieldAlert } from 'lucide-react'
import { ApiError } from '~/lib/api'
import { Button, EmptyState, Skeleton, buttonClass } from './ui'

/** Renders the right empty state for an API failure: 404 hides existence, 403 explains. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.status === 404) return <NotFoundState message={error.message} />
  if (error instanceof ApiError && error.status === 403) {
    return (
      <EmptyState
        icon={<ShieldAlert />}
        title="You can see this, but it isn't yours to change"
        description={error.message}
        action={
          <Link to="/" className={buttonClass('secondary')}>
            Back to dashboard
          </Link>
        }
      />
    )
  }
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <EmptyState
      icon={<ServerCrash />}
      title="This didn't load"
      description={message}
      action={onRetry && <Button onClick={onRetry}>Try again</Button>}
    />
  )
}

export function NotFoundState({ message }: { message?: string }) {
  return (
    <EmptyState
      icon={<Compass />}
      title="Nothing here"
      description={message ?? "This page doesn't exist, or you don't have access to it."}
      action={
        <Link to="/" className={buttonClass('secondary')}>
          Back to dashboard
        </Link>
      }
    />
  )
}

export function ForbiddenState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <EmptyState icon={<Lock />} title={title} description={description} action={action} />
}

export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface p-5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-4/5" />
            <Skeleton className="mt-5 h-8 w-28" />
          </div>
        ))}
      </div>
    </div>
  )
}
