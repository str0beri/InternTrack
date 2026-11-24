import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AttendanceMonitoringPage } from './attendance-monitoring.page';

describe('AttendanceMonitoringPage', () => {
  let component: AttendanceMonitoringPage;
  let fixture: ComponentFixture<AttendanceMonitoringPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(AttendanceMonitoringPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
