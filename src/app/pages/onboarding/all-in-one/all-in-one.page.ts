import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonContent,
  IonIcon,
  NavController
} from '@ionic/angular';

import { addIcons } from 'ionicons';
import { arrowForwardOutline } from 'ionicons/icons';

@Component({
  selector: 'app-all-in-one',
  standalone: true,
  imports: [
    IonContent,
    IonIcon,
    RouterLink
  ],
  templateUrl: './all-in-one.page.html',
  styleUrls: ['./all-in-one.page.scss']
})
export class AllInOnePage {

  private readonly navCtrl = inject(NavController);

  isLeaving = false;

  constructor() {
    addIcons({ arrowForwardOutline });
  }

  ionViewWillEnter(): void {
    this.isLeaving = false;
  }

  // Complete onboarding and navigate to login.
  next(): void {

    if (this.isLeaving) {
      return;
    }

    this.isLeaving = true;

    // Persist onboarding completion.
    localStorage.setItem(
      'interntrack.onboarded',
      'true'
    );

    setTimeout(() => {

      this.navCtrl.navigateRoot('/login', {
        animated: false
      });

    }, 300);
  }
}