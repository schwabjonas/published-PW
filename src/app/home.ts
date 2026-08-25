import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AnimatedHead } from './animated-head';

@Component({
  selector: 'app-home',
  imports: [RouterLink, AnimatedHead],
  templateUrl: './home.html',
})
export class Home {}
