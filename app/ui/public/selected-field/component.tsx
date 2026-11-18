import type { Handle } from 'remix/component'
import { clientEntry, ref } from 'remix/component'

export type SelectedFieldProps = {
  describedBy: string
  id: string
  isInvalid: boolean
  name: string
  value: string
}

/**
 * A text input that arrives focused with its value selected, so replacing a suggested name is
 * one keystroke (`11d`). `autofocus` alone focuses and leaves the caret at the end.
 */
export const SelectedField = clientEntry(
  import.meta.url,
  function SelectedField(handle: Handle<SelectedFieldProps>) {
    return () => {
      let { describedBy, id, isInvalid, name, value } = handle.props

      return (
        <input
          aria-describedby={describedBy}
          aria-invalid={isInvalid ? 'true' : undefined}
          autocomplete="off"
          autofocus
          class={isInvalid ? 'vdm-field__input vdm-field__input--error' : 'vdm-field__input'}
          id={id}
          mix={ref((node) => {
            let input = node as HTMLInputElement
            input.focus()
            input.select()
          })}
          name={name}
          type="text"
          value={value}
        />
      )
    }
  },
)
