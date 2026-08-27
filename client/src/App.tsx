import { Route, Switch } from 'wouter';
import { Dashboard } from './pages/dashboard.tsx';
import { Properties } from './pages/properties.tsx';
import { PropertyDetail } from './pages/property-detail.tsx';
import { Owners } from './pages/owners.tsx';
import { OwnerDetail } from './pages/owner-detail.tsx';
import { Campaigns } from './pages/campaigns.tsx';
import { CampaignDetail } from './pages/campaign-detail.tsx';
import { Mailings } from './pages/mailings.tsx';
import { Deals } from './pages/deals.tsx';
import { Suppression } from './pages/suppression.tsx';
import { Layout } from './components/Layout.tsx';

function App() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/owners" component={Owners} />
        <Route path="/owners/:id" component={OwnerDetail} />
        <Route path="/properties" component={Properties} />
        <Route path="/properties/:id" component={PropertyDetail} />
        <Route path="/mailings" component={Mailings} />
        <Route path="/campaigns" component={Campaigns} />
        <Route path="/campaigns/:id" component={CampaignDetail} />
        <Route path="/deals" component={Deals} />
        <Route path="/leads" component={Deals} />
        <Route path="/suppression" component={Suppression} />
        <Route>
          <div className="p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-800">404 - Not Found</h1>
            <p className="text-gray-600 mt-2">The page you're looking for doesn't exist.</p>
          </div>
        </Route>
      </Switch>
    </Layout>
  );
}

export default App;
