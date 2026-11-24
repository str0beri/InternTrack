import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';

@Component({
  selector: 'app-reports-records',
  templateUrl: './reports-records.page.html',
  styleUrls: ['./reports-records.page.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, CommonModule, FormsModule],
})
export class ReportsRecordsPage implements OnInit {
  constructor() {}

  ngOnInit() {}
}
