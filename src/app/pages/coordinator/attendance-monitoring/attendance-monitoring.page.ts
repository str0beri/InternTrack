import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';

@Component({
  selector: 'app-attendance-monitoring',
  templateUrl: './attendance-monitoring.page.html',
  styleUrls: ['./attendance-monitoring.page.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, CommonModule, FormsModule],
})
export class AttendanceMonitoringPage implements OnInit {
  constructor() {}

  ngOnInit() {}
}
