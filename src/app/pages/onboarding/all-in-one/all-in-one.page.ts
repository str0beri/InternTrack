import { Component, inject } from '@angular/core';

import {
  IonContent,
  NavController
} from '@ionic/angular';

@Component({
  selector: 'app-all-in-one',
  standalone: true,
  imports: [
    IonContent
  ],
  templateUrl: './all-in-one.page.html',
  styleUrls: ['./all-in-one.page.scss']
})
export class AllInOnePage {

  private readonly navCtrl = inject(NavController);

  isLeaving = false;

  ionViewWillEnter(): void {
    this.isLeaving = false;
  }

  // Complete onboarding and navigate to login.
  getStarted(): void {

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