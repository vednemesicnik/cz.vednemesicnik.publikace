import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'

export type EmptyStateProps = {
  /** The next step, a button or a link. Every empty state offers one (`11b`). */
  children?: RemixNode
  text: string
  title?: string
}

/* `11b` and `12c` draw it flush left and without the dashed frame of the design system's card:
   it stands where the rows would, not as a box of its own. */
const emptyStyle = css({
  alignItems: 'flex-start',
  border: 0,
  borderRadius: 0,
  gap: '8px',
  padding: '24px 0',
  textAlign: 'left',
  '& .vdm-empty__text': { margin: 0, maxWidth: 'none' },
})

/** The design system's `.vdm-empty`: what is not here yet, and what to do about it. */
export function EmptyState(handle: Handle<EmptyStateProps>) {
  return () => {
    let { children, text, title } = handle.props
    return (
      <div class="vdm-empty" mix={emptyStyle}>
        {title === undefined ? null : <p class="vdm-empty__title">{title}</p>}
        <p class="vdm-empty__text">{text}</p>
        {children}
      </div>
    )
  }
}
