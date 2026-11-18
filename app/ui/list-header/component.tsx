import type { Handle, RemixNode } from 'remix/component'

export type ListHeaderProps = {
  /** The action beside the title: _Nové vydání_. */
  children?: RemixNode
  title: string
}

/** The design system's `ListHeader`: the page title of a list and its one action. */
export function ListHeader(handle: Handle<ListHeaderProps>) {
  return () => (
    <div class="vdm-list-header">
      <h1 class="vdm-page-title">{handle.props.title}</h1>
      {handle.props.children === undefined ? null : (
        <div class="vdm-list-header__action">{handle.props.children}</div>
      )}
    </div>
  )
}
