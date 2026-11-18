import type { Handle, RemixNode } from 'remix/component'

export type EmptyStateProps = {
  /** The next step, a button or a link. Every empty state offers one (`11b`). */
  children?: RemixNode
  text: string
  title?: string
}

/*
 * `11b` draws it flush left and without the dashed frame of the design system's card: it
 * stands where the rows would, not as a box of its own. Inline, as the drawing writes it,
 * because `css()` sits in a cascade layer and would lose to `.vdm-empty` on the same element.
 */
const EMPTY_STYLE = {
  alignItems: 'flex-start',
  border: 0,
  borderRadius: 0,
  gap: '8px',
  padding: '24px 0',
  textAlign: 'left',
} as const

/** The design system's `.vdm-empty`: what is not here yet, and what to do about it. */
export function EmptyState(handle: Handle<EmptyStateProps>) {
  return () => {
    let { children, text, title } = handle.props
    return (
      <div class="vdm-empty" style={EMPTY_STYLE}>
        {title === undefined ? null : <p class="vdm-empty__title">{title}</p>}
        <p class="vdm-empty__text" style={{ margin: 0, maxWidth: 'none' }}>
          {text}
        </p>
        {children}
      </div>
    )
  }
}
