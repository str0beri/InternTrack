import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';

@Component({
  selector: 'app-internship-assignments',
  templateUrl: './internship-assignments.page.html',
  styleUrls: ['./internship-assignments.page.scss'],
  imports: [IonContent, IonHeader, IonTitle, IonToolbar, CommonModule, FormsModule],
})
export class InternshipAssignmentsPage implements OnInit {
  constructor() {}

  ngOnInit() {}
}
