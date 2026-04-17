import { Switch, Route, Router as WouterRouter } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import SetupForm from "@/pages/SetupForm";
import Result from "@/pages/Result";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={SetupForm} />
      <Route path="/result" component={Result} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Router />
      <Toaster />
    </WouterRouter>
  );
}
