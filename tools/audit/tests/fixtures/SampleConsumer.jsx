import SampleComponent from './SampleComponent'
const X = lazy(() => import('./SampleComponent'))
export default function Consumer() { return <SampleComponent /> }
