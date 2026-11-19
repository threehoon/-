import { StudioApp } from '@/app/StudioApp'
import { corePorts } from '@/app/core-ports'
import { useStudio } from '@/app/use-studio'

export default function App() {
  const api = useStudio(corePorts)
  return <StudioApp api={api} />
}
