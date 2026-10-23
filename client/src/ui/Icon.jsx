import { icon } from './icons'

/** One of the SVG icons in ui/icons.js, inline with the text around it. */
export function Icon({ name, className = '' }) {
  return <span className={`ico-wrap ${className}`} dangerouslySetInnerHTML={{ __html: icon(name) }} />
}

export default Icon
