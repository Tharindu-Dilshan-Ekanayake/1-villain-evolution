import Shatter from './Shatter'
import StageLine from './StageLine'
import Walls from './Walls'

/**
 * Everything past the STAGES gate: the stage line, its breakable walls and the
 * shatter pool. A lazily loaded chunk (React.lazy), mounted once the lobby is up;
 * every texture, geometry and material it makes is disposed when it unmounts.
 */
export default function StageWorld() {
  return (
    <>
      <StageLine />
      <Walls />
      <Shatter />
    </>
  )
}
