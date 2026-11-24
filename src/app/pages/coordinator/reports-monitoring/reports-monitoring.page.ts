import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';

@Component({
  selector: 'app-reports-monitoring',
  templateUrl: './reports-monitoring.page.html',
  styleUrls: ['./reports-monitoring.page.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, CommonModule, FormsModule],
})
export class ReportsMonitoringPage implements OnInit {
  constructor() {}

  ngOnInit() {}
}
