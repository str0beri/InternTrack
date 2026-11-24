import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CompanySupervisorsPage } from './company-supervisors.page';

describe('CompanySupervisorsPage', () => {
  let component: CompanySupervisorsPage;
  let fixture: ComponentFixture<CompanySupervisorsPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(CompanySupervisorsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
