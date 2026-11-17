import type { Handle, RemixNode } from 'remix/component'

export type CalloutProps = {
  children?: RemixNode
  /** `info` has no icon; `error` carries the circle-alert icon, as the design system draws it. */
  tone: 'error' | 'info'
}

/** The design system's `Callout`: a tinted note inside the page. */
export function Callout(handle: Handle<CalloutProps>) {
  return () => {
    let { children, tone } = handle.props

    if (tone === 'info') return <aside class="vdm-callout">{children}</aside>

    return (
      <aside class="vdm-callout vdm-callout--error vdm-callout--icon">
        <svg
          aria-hidden="true"
          class="vdm-callout__icon"
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
        <div class="vdm-callout__body">{children}</div>
      </aside>
    )
  }
}
