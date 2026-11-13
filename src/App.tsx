import { Shell } from './components/Shell';
import { useRoute } from './state/router';
import { Activity } from './views/Activity';
import { Dashboard } from './views/Dashboard';
import { DataSettings } from './views/DataSettings';
import { Journal } from './views/Journal';
import { OAuthConsent } from './views/OAuthConsent';
import { Planner } from './views/Planner';
import { Portfolio } from './views/Portfolio';
import { ProjectDetail } from './views/ProjectDetail';
import { Review } from './views/Review';

export default function App() {
  const route = useRoute();
  let view;
  switch (route.view) {
    case 'portfolio':
      view = <Portfolio />;
      break;
    case 'project':
      view = <ProjectDetail key={route.param} id={route.param ?? ''} />;
      break;
    case 'plan':
      view = <Planner />;
      break;
    case 'review':
      view = <Review />;
      break;
    case 'activity':
      view = <Activity />;
      break;
    case 'journal':
      view = <Journal day={route.param} />;
      break;
    case 'data':
      view = <DataSettings />;
      break;
    case 'oauth':
      view = <OAuthConsent />;
      break;
    default:
      view = <Dashboard />;
  }
  return <Shell view={route.view}>{view}</Shell>;
}
