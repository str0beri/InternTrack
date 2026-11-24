import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CoordinatorLayoutPage } from './coordinator-layout.page';

describe('CoordinatorLayoutPage', () => {
  let component: CoordinatorLayoutPage;
  let fixture: ComponentFixture<CoordinatorLayoutPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(CoordinatorLayoutPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
