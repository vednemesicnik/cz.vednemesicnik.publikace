import type { Handle } from 'remix/component'
import { css } from 'remix/component'

export type ToastTone = 'error' | 'neutral'

export type ToastMessage = { message: string; tone: ToastTone }

export type ToastsProps = {
  messages: readonly ToastMessage[]
}

/*
 * Bottom left, over the page and clear of the panel's foot.
 *
 * The message arrives with the page after a redirect, and a screen reader does not announce a
 * status that is already there when the page loads; the outcome is carried by the page itself,
 * the new row in the list. So a confirmation leaves by itself after five seconds, in CSS, as the
 * page has no script to time it.
 */
const regionStyle = css({
  bottom: '18px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  left: '242px',
  maxWidth: 'calc(100vw - 260px)',
  pointerEvents: 'none',
  position: 'fixed',
  zIndex: 'var(--z-notification)',
  '@media (max-width: 767.98px)': { left: '16px', maxWidth: 'calc(100vw - 32px)' },
})

const toastStyle = css({
  animation: 'publikace-toast-leave 300ms ease-in-out 5s forwards',
  '@media (prefers-reduced-motion: reduce)': { animationDuration: '1ms' },
})

/* A keyframes rule is not a style of one element, so it is written as a sheet beside them. */
const LEAVE_KEYFRAMES =
  '@keyframes publikace-toast-leave { to { opacity: 0; visibility: hidden; } }'

/**
 * The design system's `Toast`. An error carries the alert icon, as the design system draws it,
 * and stays: it asks for a step (_Zkuste dokončit vydání za chvíli znovu._), and a message that
 * leaves by itself could leave before it is read.
 */
export function Toasts(handle: Handle<ToastsProps>) {
  return () => {
    let { messages } = handle.props
    let isAnyLeaving = messages.some((toast) => toast.tone === 'neutral')

    return (
      <div mix={regionStyle} role="status">
        {isAnyLeaving ? <style>{LEAVE_KEYFRAMES}</style> : null}
        {messages.map((toast) =>
          toast.tone === 'error' ? (
            <div class="vdm-toast vdm-toast--error" role="alert">
              <svg
                aria-hidden="true"
                class="vdm-toast__icon"
                fill="none"
                focusable="false"
                height="16"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                viewBox="0 0 24 24"
                width="16"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
              </svg>
              <span class="vdm-toast__text">{toast.message}</span>
            </div>
          ) : (
            <div class="vdm-toast" mix={toastStyle}>
              <span class="vdm-toast__text">{toast.message}</span>
            </div>
          ),
        )}
      </div>
    )
  }
}
