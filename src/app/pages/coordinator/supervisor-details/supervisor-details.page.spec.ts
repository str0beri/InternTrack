import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SupervisorDetailsPage } from './supervisor-details.page';

describe('SupervisorDetailsPage', () => {
  let component: SupervisorDetailsPage;
  let fixture: ComponentFixture<SupervisorDetailsPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(SupervisorDetailsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
