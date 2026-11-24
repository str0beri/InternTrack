import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';

@Component({
  selector: 'app-company-supervisors',
  templateUrl: './company-supervisors.page.html',
  styleUrls: ['./company-supervisors.page.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, CommonModule, FormsModule],
})
export class CompanySupervisorsPage implements OnInit {
  constructor() {}

  ngOnInit() {}
}
