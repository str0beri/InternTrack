import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReportsRecordsPage } from './reports-records.page';

describe('ReportsRecordsPage', () => {
  let component: ReportsRecordsPage;
  let fixture: ComponentFixture<ReportsRecordsPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ReportsRecordsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
