import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReportsMonitoringPage } from './reports-monitoring.page';

describe('ReportsMonitoringPage', () => {
  let component: ReportsMonitoringPage;
  let fixture: ComponentFixture<ReportsMonitoringPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ReportsMonitoringPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
