import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SupervisorProfilePage } from './supervisor-profile.page';

describe('SupervisorProfilePage', () => {
  let component: SupervisorProfilePage;
  let fixture: ComponentFixture<SupervisorProfilePage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(SupervisorProfilePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
