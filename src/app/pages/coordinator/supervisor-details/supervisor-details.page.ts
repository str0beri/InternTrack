import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';

@Component({
  selector: 'app-supervisor-details',
  templateUrl: './supervisor-details.page.html',
  styleUrls: ['./supervisor-details.page.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, CommonModule, FormsModule],
})
export class SupervisorDetailsPage implements OnInit {
  constructor() {}

  ngOnInit() {}
}
