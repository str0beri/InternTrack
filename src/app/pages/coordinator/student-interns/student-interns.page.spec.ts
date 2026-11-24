import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StudentInternsPage } from './student-interns.page';

describe('StudentInternsPage', () => {
  let component: StudentInternsPage;
  let fixture: ComponentFixture<StudentInternsPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(StudentInternsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
