import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InternshipAssignmentsPage } from './internship-assignments.page';

describe('InternshipAssignmentsPage', () => {
  let component: InternshipAssignmentsPage;
  let fixture: ComponentFixture<InternshipAssignmentsPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(InternshipAssignmentsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
