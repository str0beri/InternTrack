import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';

@Component({
  selector: 'app-supervisor-profile',
  templateUrl: './supervisor-profile.page.html',
  styleUrls: ['./supervisor-profile.page.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, CommonModule, FormsModule],
})
export class SupervisorProfilePage implements OnInit {
  constructor() {}

  ngOnInit() {}
}
