import { Routes } from '@angular/router';

import { Art } from './art';
import { Home } from './home';
import { Portfolio } from './portfolio';
import { ProjectDetail } from './project-detail';

// The /chat route (the AI avatar) is intentionally absent from this build —
// it needs a live backend, which this static site deliberately does not have.
// See README.md; the full version lives in the private Personal-Website repo.
export const routes: Routes = [
  { path: '', component: Home, title: 'Jonas - Home' },
  { path: 'portfolio', component: Portfolio, title: 'Jonas - Portfolio' },
  { path: 'portfolio/:slug', component: ProjectDetail, title: 'Jonas - Project' },
  { path: 'art', component: Art, title: 'Jonas - Art' },
  { path: '**', redirectTo: '' },
];
