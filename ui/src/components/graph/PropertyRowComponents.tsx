interface PropertyNameProps {
  name: string
}

/** 属性名（只读，原样显示）。 */
export const PropertyName = ({ name }: PropertyNameProps) => {
  return (
    <span className="text-primary/60 tracking-wide whitespace-nowrap">
      {name}
    </span>
  )
}

interface PropertyValueProps {
  value: unknown
  onClick?: () => void
  tooltip?: string
}

/** 属性值（只读，超长截断 + title 提示）。 */
export const PropertyValue = ({ value, onClick, tooltip }: PropertyValueProps) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <div className="flex items-center gap-1 overflow-hidden">
      <span
        className="hover:bg-primary/20 rounded p-1 overflow-hidden text-ellipsis whitespace-nowrap cursor-default"
        title={tooltip || text}
        onClick={onClick}
      >
        {text}
      </span>
    </div>
  )
}
