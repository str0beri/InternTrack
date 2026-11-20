import {
  Component,
  ChangeDetectorRef,
  inject,
  type OnDestroy
} from '@angular/core';

import {
  ActivatedRoute
} from '@angular/router';

import {
  AlertController,
  IonContent,
  IonIcon,
  type ViewWillEnter
} from '@ionic/angular';

import {
  DomSanitizer,
  SafeResourceUrl
} from '@angular/platform-browser';

import { addIcons } from 'ionicons';

import {
  cafeOutline,
  checkmarkCircleOutline,
  chevronBackOutline,
  chevronForwardOutline,
  downloadOutline,
  timeOutline
} from 'ionicons/icons';

import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

import type {
  TDocumentDefinitions,
  TableCell
} from 'pdfmake/interfaces';

import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';

// Initialize bundled PDF fonts.
pdfMake.addVirtualFileSystem(
  pdfFonts as unknown as Record<string, string>
);

/* =========================================
  INTERFACES
========================================= */

interface CalendarDay {
  date: Date;
  key: string;
  number: number;
  label: string;
  fullLabel: string;
}

type DtrStatus =
  | 'verified'
  | 'provisional'
  | 'rejected';

interface DtrRecord {
  date: string;
  timeIn: string;
  timeOut: string;
  status: DtrStatus;
  minutes: number;
}

/* =========================================
  DTR PAGE
========================================= */

@Component({
  selector: 'app-dtr',
  standalone: true,
  imports: [
    IonContent,
    IonIcon
  ],
  templateUrl: './dtr.page.html',
  styleUrls: ['./dtr.page.scss']
})
export class DtrPage implements ViewWillEnter, OnDestroy {

  private readonly route = inject(ActivatedRoute);
  private readonly alertController = inject(AlertController);
  private readonly supabaseService = inject(SupabaseService);
  private readonly authService = inject(AuthService);
  private readonly cdRef = inject(ChangeDetectorRef);
  private readonly sanitizer = inject(DomSanitizer);

  private readonly supabase =
    this.supabaseService.getClient();

  private destroyed = false;

  /* =========================================
    STUDENT INFORMATION
  ========================================= */

  studentId = '';
  studentFullName = '';
  studentCompany = '';

  /* =========================================
    CALENDAR SETTINGS
  ========================================= */

  calendarMode: 'weekly' | 'monthly' = 'weekly';

  selectedDate: Date = new Date();

  weekdays = [
    'SUN',
    'MON',
    'TUE',
    'WED',
    'THU',
    'FRI',
    'SAT'
  ];

  /* =========================================
    OJT HOURS
  ========================================= */

  requiredHours = 486;

  verifiedHours = 0;
  provisionalHours = 0;

  records: DtrRecord[] = [];

  /* =========================================
    PDF PREVIEW
  ========================================= */

  isGeneratingPdf = false;
  isPdfPreviewOpen = false;

  pdfPreviewUrl: SafeResourceUrl | null = null;

  private pdfObjectUrl: string | null = null;

  constructor() {
    addIcons({
      chevronBackOutline,
      chevronForwardOutline,
      cafeOutline,
      checkmarkCircleOutline,
      timeOutline,
      downloadOutline
    });
  }

  /* =========================================
    LIFECYCLE
  ========================================= */

  ngOnDestroy(): void {
    this.destroyed = true;
    this.closePdfPreview();
  }

  private refresh(): void {
    if (!this.destroyed) {
      this.cdRef.detectChanges();
    }
  }

  async ionViewWillEnter(): Promise<void> {
    const id =
      this.route.snapshot.queryParamMap.get('studentId') ||
      this.authService.getStudentId() ||
      localStorage.getItem('studentId');

    if (!id) {
      console.error(
        'DTR: No student ID found.'
      );

      this.studentId = '';
      this.studentFullName = '';
      this.studentCompany = '';

      this.records = [];
      this.verifiedHours = 0;
      this.provisionalHours = 0;

      this.refresh();
      return;
    }

    this.studentId = id;

    const results = await Promise.allSettled([
      this.loadStudentProfile(),
      this.loadAttendanceFromSupabase()
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(
          'DTR: Data loading failed:',
          result.reason
        );
      }
    }

    this.refresh();
  }

  /* =========================================
    STUDENT PROFILE
  ========================================= */

  private async loadStudentProfile(): Promise<void> {
    this.studentFullName = '';
    this.studentCompany = '';

    const { data, error } = await this.supabase
      .from('students')
      .select('*')
      .eq('student_id', this.studentId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return;
    }

    this.studentFullName =
      data.full_name ||
      data.name ||
      '';

    this.studentCompany =
      data.company_location ||
      data.company_name ||
      '';
  }

  /* =========================================
    DATE HELPERS
  ========================================= */

  private dateKey(date: Date): string {
    const year = date.getFullYear();

    const month = String(
      date.getMonth() + 1
    ).padStart(2, '0');

    const day = String(
      date.getDate()
    ).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private createDay(date: Date): CalendarDay {
    const copy = new Date(date);

    return {
      date: copy,
      key: this.dateKey(copy),
      number: copy.getDate(),

      label: copy.toLocaleDateString(
        'en-US',
        {
          weekday: 'short'
        }
      ).toUpperCase(),

      fullLabel: copy.toLocaleDateString(
        'en-US',
        {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        }
      )
    };
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString(
      'en-US',
      {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }
    );
  }

  private formatTime(
    value: string | null
  ): string {
    if (!value) {
      return '';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleTimeString(
      'en-US',
      {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }
    );
  }

  /* =========================================
    CALENDAR LABELS
  ========================================= */

  get monthLabel(): string {
    return this.selectedDate.toLocaleDateString(
      'en-US',
      {
        month: 'short',
        year: 'numeric'
      }
    );
  }

  get selectedDateLabel(): string {
    return this.selectedDate.toLocaleDateString(
      'en-US',
      {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      }
    );
  }

  /* =========================================
    WEEKLY CALENDAR
  ========================================= */

  get weeklyDays(): CalendarDay[] {
    const start = new Date(this.selectedDate);

    start.setDate(
      start.getDate() - start.getDay()
    );

    const days: CalendarDay[] = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(start);

      date.setDate(
        start.getDate() + i
      );

      days.push(this.createDay(date));
    }

    return days;
  }

  /* =========================================
    MONTHLY CALENDAR
  ========================================= */

  get monthlyDays(): (CalendarDay | null)[] {
    const year = this.selectedDate.getFullYear();
    const month = this.selectedDate.getMonth();

    const firstDay = new Date(
      year,
      month,
      1
    );

    const daysInMonth = new Date(
      year,
      month + 1,
      0
    ).getDate();

    const days: (CalendarDay | null)[] = [];

    for (
      let i = 0;
      i < firstDay.getDay();
      i++
    ) {
      days.push(null);
    }

    for (
      let i = 1;
      i <= daysInMonth;
      i++
    ) {
      days.push(
        this.createDay(
          new Date(year, month, i)
        )
      );
    }

    return days;
  }

  /* =========================================
    CALENDAR ACTIONS
  ========================================= */

  setCalendarMode(
    mode: 'weekly' | 'monthly'
  ): void {
    this.calendarMode = mode;
  }

  selectDate(date: Date): void {
    this.selectedDate = new Date(date);
  }

  isSelected(key: string): boolean {
    return this.dateKey(
      this.selectedDate
    ) === key;
  }

  changePeriod(direction: number): void {
    const current = new Date(
      this.selectedDate
    );

    if (this.calendarMode === 'weekly') {
      current.setDate(
        current.getDate() + direction * 7
      );

      this.selectedDate = current;
      return;
    }

    const year = current.getFullYear();
    const month = current.getMonth() + direction;
    const day = current.getDate();

    const targetStart = new Date(
      year,
      month,
      1
    );

    const lastDay = new Date(
      targetStart.getFullYear(),
      targetStart.getMonth() + 1,
      0
    ).getDate();

    this.selectedDate = new Date(
      targetStart.getFullYear(),
      targetStart.getMonth(),
      Math.min(day, lastDay)
    );
  }

  getMarker(
    date: string
  ): 'verified' | 'provisional' | null {
    const dayRecords = this.records.filter(
      record => record.date === date
    );

    if (dayRecords.some(
      record => record.status === 'verified'
    )) {
      return 'verified';
    }

    if (dayRecords.some(
      record => record.status === 'provisional'
    )) {
      return 'provisional';
    }

    return null;
  }

  get selectedRecord(): DtrRecord | undefined {
    const selectedKey = this.dateKey(
      this.selectedDate
    );

    return this.records.find(
      record => record.date === selectedKey
    );
  }

  /* =========================================
    HOURS
  ========================================= */

  get totalHours(): number {
    return (
      this.verifiedHours +
      this.provisionalHours
    );
  }

  get remainingHours(): number {
    return Math.max(
      0,
      this.requiredHours - this.totalHours
    );
  }

  /* =========================================
     LOAD ATTENDANCE FROM SUPABASE
     ========================================= */

  async loadAttendanceFromSupabase(): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .from('attendance')
        .select('*')
        .eq('student_id', this.studentId)
        .order('created_at', {
          ascending: false
        });

      if (error) {
        throw error;
      }

      let verifiedMinutes = 0;
      let provisionalMinutes = 0;

      this.records = (data || []).map(row => {
        const sourceDate =
          row.time_in ||
          row.created_at;

        const parsedDate = sourceDate
          ? new Date(sourceDate)
          : null;

        const dateStr =
          parsedDate &&
          !Number.isNaN(parsedDate.getTime())
            ? this.dateKey(parsedDate)
            : '';

        const timeIn = this.formatTime(
          row.time_in
        );

        const timeOut = this.formatTime(
          row.time_out
        );

        let minutes = 0;

        if (row.time_in && row.time_out) {
          const start = new Date(
            row.time_in
          ).getTime();

          const end = new Date(
            row.time_out
          ).getTime();

          const difference = end - start;

          if (
            Number.isFinite(difference) &&
            difference > 0
          ) {
            minutes = Math.floor(
              difference / 60000
            );
          }
        }

        const rawStatus = String(
          row.verification_status || ''
        ).toLowerCase();

        let status: DtrStatus = 'provisional';

        if (rawStatus === 'verified') {
          status = 'verified';
        } else if (
          rawStatus === 'rejected'
        ) {
          status = 'rejected';
        }

        if (status === 'verified') {
          verifiedMinutes += minutes;
        } else if (
          status === 'provisional'
        ) {
          provisionalMinutes += minutes;
        }

        return {
          date: dateStr,
          timeIn,
          timeOut,
          status,
          minutes
        };
      });

      this.verifiedHours =
        verifiedMinutes / 60;

      this.provisionalHours =
        provisionalMinutes / 60;

    } catch (error) {
      console.error(
        'DTR: Failed to load attendance:',
        error
      );

      this.records = [];
      this.verifiedHours = 0;
      this.provisionalHours = 0;

    } finally {
      this.refresh();
    }
  }

  /* =========================================
     WEEKLY DATE RANGE
     ========================================= */

  private getWeekRange(): {
    start: Date;
    end: Date;
  } {
    const start = new Date(
      this.selectedDate
    );

    start.setHours(0, 0, 0, 0);

    start.setDate(
      start.getDate() - start.getDay()
    );

    const end = new Date(start);

    end.setDate(
      start.getDate() + 6
    );

    return {
      start,
      end
    };
  }

  /* =========================================
     CREATE WEEKLY PDF
     ========================================= */

  private createWeeklyPdf(): TDocumentDefinitions {
    const { start, end } =
      this.getWeekRange();

    const startKey = this.dateKey(start);
    const endKey = this.dateKey(end);

    const weekRecords = this.records
      .filter(record =>
        record.date >= startKey &&
        record.date <= endKey
      )
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date)
      );

    const verifiedMinutes = weekRecords
      .filter(
        record => record.status === 'verified'
      )
      .reduce(
        (total, record) =>
          total + record.minutes,
        0
      );

    const provisionalMinutes = weekRecords
      .filter(
        record => record.status === 'provisional'
      )
      .reduce(
        (total, record) =>
          total + record.minutes,
        0
      );

    const formatHours = (
      minutes: number
    ): string => {
      return minutes > 0
        ? (minutes / 60).toFixed(1)
        : '—';
    };

    const tableBody: TableCell[][] = [
      [
        { text: 'Date', bold: true },
        { text: 'Time In', bold: true },
        { text: 'Time Out', bold: true },
        { text: 'Hours', bold: true },
        { text: 'Status', bold: true }
      ]
    ];

    // Include all seven calendar days.
    for (let i = 0; i < 7; i++) {
      const day = new Date(start);

      day.setDate(
        start.getDate() + i
      );

      const dayKey = this.dateKey(day);

      const dayRecords = weekRecords.filter(
        record => record.date === dayKey
      );

      if (dayRecords.length === 0) {
        tableBody.push([
          this.formatDate(day),
          '—',
          '—',
          '—',
          'No Record'
        ]);

        continue;
      }

      for (const record of dayRecords) {
        const statusLabel =
          record.status === 'verified'
            ? 'Verified'
            : record.status === 'rejected'
              ? 'Rejected'
              : 'Provisional';

        tableBody.push([
          this.formatDate(day),
          record.timeIn || '—',
          record.timeOut || '—',
          formatHours(record.minutes),
          statusLabel
        ]);
      }
    }

    const verifiedHours =
      verifiedMinutes / 60;

    const provisionalHours =
      provisionalMinutes / 60;

    const weeklyTotal =
      verifiedHours + provisionalHours;

    const definition: TDocumentDefinitions = {
      pageSize: 'A4',

      pageOrientation: 'portrait',

      pageMargins: [
        35,
        40,
        35,
        45
      ],

      defaultStyle: {
        font: 'Roboto',
        fontSize: 9,
        color: '#252525'
      },

      content: [
        {
          text: 'INTERNTRACK',
          alignment: 'center',
          fontSize: 10,
          bold: true,
          color: '#3157d5',
          margin: [0, 0, 0, 5]
        },

        {
          text: 'DAILY TIME RECORD',
          alignment: 'center',
          fontSize: 17,
          bold: true,
          margin: [0, 0, 0, 6]
        },

        {
          text:
            `${this.formatDate(start)} - ` +
            this.formatDate(end),

          alignment: 'center',
          color: '#666666',
          margin: [0, 0, 0, 20]
        },

        {
          columns: [
            {
              width: '*',

              stack: [
                {
                  text: 'Student Name',
                  color: '#777777',
                  fontSize: 8
                },
                {
                  text:
                    this.studentFullName ||
                    'Not available',

                  bold: true,
                  margin: [0, 3, 0, 12]
                },
                {
                  text: 'Company',
                  color: '#777777',
                  fontSize: 8
                },
                {
                  text:
                    this.studentCompany ||
                    'Not available',

                  bold: true,
                  margin: [0, 3, 0, 12]
                }
              ]
            },

            {
              width: 160,

              stack: [
                {
                  text: 'Student ID',
                  color: '#777777',
                  fontSize: 8
                },
                {
                  text: this.studentId,
                  bold: true,
                  margin: [0, 3, 0, 12]
                },
                {
                  text: 'Required OJT Hours',
                  color: '#777777',
                  fontSize: 8
                },
                {
                  text:
                    `${this.requiredHours} hrs`,

                  bold: true,
                  margin: [0, 3, 0, 12]
                }
              ]
            }
          ]
        },

        {
          text: 'WEEKLY ATTENDANCE',
          bold: true,
          fontSize: 10,
          margin: [0, 8, 0, 10]
        },

        {
          table: {
            headerRows: 1,

            widths: [
              '*',
              75,
              75,
              45,
              75
            ],

            body: tableBody
          },

          layout: {
            fillColor: (
              rowIndex: number
            ) => {
              if (rowIndex === 0) {
                return '#e8edff';
              }

              return rowIndex % 2 === 0
                ? '#f7f8fc'
                : null;
            },

            hLineColor: () => '#dddddd',
            vLineColor: () => '#dddddd',

            paddingTop: () => 8,
            paddingBottom: () => 8,
            paddingLeft: () => 6,
            paddingRight: () => 6
          },

          margin: [0, 0, 0, 18]
        },

        {
          text: 'WEEKLY HOURS SUMMARY',
          bold: true,
          fontSize: 10,
          margin: [0, 0, 0, 10]
        },

        {
          table: {
            widths: [
              '*',
              110
            ],

            body: [
              [
                'Verified Hours',
                `${verifiedHours.toFixed(1)} hrs`
              ],
              [
                'Provisional Hours',
                `${provisionalHours.toFixed(1)} hrs`
              ],
              [
                {
                  text: 'Total Recorded Hours',
                  bold: true
                },
                {
                  text:
                    `${weeklyTotal.toFixed(1)} hrs`,

                  bold: true
                }
              ]
            ]
          },

          layout: 'lightHorizontalLines',
          margin: [0, 0, 0, 12]
        },

        {
          text:
            'Provisional hours are subject to ' +
            'supervisor approval. Rejected records ' +
            'are excluded from the hours summary.',

          fontSize: 8,
          italics: true,
          color: '#777777',
          margin: [0, 0, 0, 35]
        },

        {
          columns: [
            {
              width: '*',

              stack: [
                {
                  text:
                    '________________________',

                  alignment: 'center'
                },
                {
                  text: 'Student Signature',
                  alignment: 'center',
                  fontSize: 8,
                  margin: [0, 6, 0, 0]
                }
              ]
            },

            {
              width: '*',

              stack: [
                {
                  text:
                    '________________________',

                  alignment: 'center'
                },
                {
                  text:
                    'Company Supervisor Signature',

                  alignment: 'center',
                  fontSize: 8,
                  margin: [0, 6, 0, 0]
                }
              ]
            }
          ]
        }
      ],

      footer: (
        currentPage: number,
        pageCount: number
      ) => ({
        text:
          `InternTrack | Page ${currentPage} of ${pageCount}`,

        alignment: 'center',
        fontSize: 8,
        color: '#999999'
      })
    };

    return definition;
  }

  /* =========================================
     PDF HELPERS
     ========================================= */

  private async generatePdfBlob(): Promise<Blob> {
    const definition = this.createWeeklyPdf();

    const blob = await pdfMake
      .createPdf(definition)
      .getBlob();

    return blob;
  }

    private getPdfFilename(): string {
      const { start, end } =
        this.getWeekRange();

      return (
        `InternTrack-DTR-` +
        `${this.dateKey(start)}-to-` +
        `${this.dateKey(end)}.pdf`
      );
    }

  private async showError(
    header: string,
    message: string
  ): Promise<void> {
    const alert =
      await this.alertController.create({
        header,
        message,
        buttons: ['OK']
      });

    await alert.present();
  }

  /* =========================================
     PREVIEW WEEKLY PDF
     ========================================= */

  async previewDtr(): Promise<void> {
    if (this.isGeneratingPdf) {
      return;
    }

    this.isGeneratingPdf = true;
    this.refresh();

    try {
      const blob =
        await this.generatePdfBlob();

      this.closePdfPreview();

      this.pdfObjectUrl =
        URL.createObjectURL(blob);

      this.pdfPreviewUrl =
        this.sanitizer
          .bypassSecurityTrustResourceUrl(
            this.pdfObjectUrl
          );

      this.isPdfPreviewOpen = true;

    } catch (error) {
      console.error(
        'DTR: PDF preview failed:',
        error
      );

      await this.showError(
        'Preview unavailable',
        'Unable to generate the weekly DTR PDF.'
      );

    } finally {
      this.isGeneratingPdf = false;
      this.refresh();
    }
  }

  /* =========================================
     EXPORT WEEKLY PDF
     ========================================= */

  async exportDtr(): Promise<void> {
    if (this.isGeneratingPdf) {
      return;
    }

    this.isGeneratingPdf = true;
    this.refresh();

    try {
      const blob =
        await this.generatePdfBlob();

      const url =
        URL.createObjectURL(blob);

      const link =
        document.createElement('a');

      link.href = url;
      link.download = this.getPdfFilename();

      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 60000);

    } catch (error) {
      console.error(
        'DTR: PDF export failed:',
        error
      );

      await this.showError(
        'Export failed',
        'Unable to generate the weekly DTR PDF.'
      );

    } finally {
      this.isGeneratingPdf = false;
      this.refresh();
    }
  }

  /* =========================================
     CLOSE PDF PREVIEW
     ========================================= */

  closePdfPreview(): void {
    this.isPdfPreviewOpen = false;
    this.pdfPreviewUrl = null;

    if (this.pdfObjectUrl) {
      URL.revokeObjectURL(
        this.pdfObjectUrl
      );

      this.pdfObjectUrl = null;
    }
  }
}
