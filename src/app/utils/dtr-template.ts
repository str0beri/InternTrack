import type {
  TDocumentDefinitions,
  TableCell,
  ContentStack
} from 'pdfmake/interfaces';

// ==========================================
// DTR INTERFACES
// ==========================================

export interface DtrTemplateRecord {
  date: string;
  timeIn: string;
  timeOut: string;
  minutes: number;

  status:
    | 'verified'
    | 'provisional'
    | 'rejected'
    | 'incomplete'
    | 'unknown';

  syncStatus: 'synced' | 'pending_upload';

  remarks?: string;
}

export interface DtrTemplateData {
  studentName: string;
  studentId: string;
  schoolName?: string;
  course?: string;
  company: string;
  supervisorName?: string;
  startDate: string;
  endDate: string;
  records: DtrTemplateRecord[];

  isCachedData?: boolean;
  includeEmptyDates?: boolean;
  includeRemarks?: boolean;
  placementNote?: string;
  reviewerRole?: string;
}

// ==========================================
// SHARED DTR TEMPLATE
// ==========================================

export function createDtrTemplate(
  data: DtrTemplateData
): TDocumentDefinitions {

  // ========================================
  // BRAND COLORS
  // ========================================

  const colors = {
    blue: '#3157D5',
    purple: '#7556D9',
    orange: '#FF9638',
    green: '#087B56',
    red: '#C92A2A',
    warning: '#B36A08',
    text: '#172033',
    muted: '#64748B',
    border: '#DCE2ED',
    white: '#FFFFFF',
    background: '#F8FAFC'
  };

  const schoolName =
    data.schoolName ||
    'Pamantasan ng Lungsod ng Valenzuela';

  const reviewerRole =
    data.reviewerRole || 'Company Supervisor';

  const includeEmptyDates =
    data.includeEmptyDates ?? true;

  const includeRemarks =
    data.includeRemarks ?? false;

  // ========================================
  // DATE AND HOURS FORMATTERS
  // ========================================

  const formatDate = (
    value: string,
    includeDay = false
  ): string => {

    const date = new Date(`${value}T12:00:00`);

    if (Number.isNaN(date.getTime())) {
      return value || 'Not available';
    }

    return date.toLocaleDateString('en-US', {
      ...(includeDay
        ? { weekday: 'short' as const }
        : {}),
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatHours = (minutes: number): string => {

    if (!Number.isFinite(minutes) || minutes < 0) {
      return '0.00';
    }

    return (minutes / 60).toFixed(2);
  };

  const hasTime = (value: string): boolean => {

    const time = value?.trim();

    return Boolean(
      time &&
      time !== '—' &&
      time !== '-' &&
      time !== 'N/A'
    );
  };

  // ========================================
  // FILTER ATTENDANCE RECORDS
  // ========================================

  const records = data.records
    .filter(record =>
      record.date >= data.startDate &&
      record.date <= data.endDate
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  // ========================================
  // ATTENDANCE TABLE HEADER
  // ========================================

  const headers = [
    'Date',
    'Time in',
    'Time out',
    'Hours',
    'Status'
  ];

  if (includeRemarks) {
    headers.push('Remarks');
  }

  const attendanceBody: TableCell[][] = [
    headers.map(text => ({
      text,
      bold: true,
      color: colors.white,
      fontSize: 9
    }))
  ];

  // ========================================
  // ATTENDANCE STATUS
  // ========================================

  const getStatus = (
    record: DtrTemplateRecord
  ): {
    label: string;
    color: string;
  } => {

    if (record.status === 'rejected') {
      return {
        label: 'Rejected',
        color: colors.red
      };
    }

    if (record.syncStatus === 'pending_upload') {
      return {
        label: 'Pending sync',
        color: colors.warning
      };
    }

    if (
      record.status === 'incomplete' ||
      !hasTime(record.timeIn) ||
      !hasTime(record.timeOut)
    ) {
      return {
        label: 'Incomplete',
        color: colors.warning
      };
    }

    if (record.status === 'verified') {
      return {
        label: 'Verified',
        color: colors.green
      };
    }

    if (record.status === 'provisional') {
      return {
        label: 'Provisional',
        color: colors.purple
      };
    }

    return {
      label: 'Unknown',
      color: colors.muted
    };
  };

  // ========================================
  // ADD ATTENDANCE ROW
  // ========================================

  const addAttendanceRow = (
    date: string,
    record?: DtrTemplateRecord
  ): void => {

    if (!record) {

      const emptyRow: TableCell[] = [
        formatDate(date, true),
        '—',
        '—',
        '—',
        {
          text: 'No record',
          color: colors.muted
        }
      ];

      if (includeRemarks) {
        emptyRow.push('—');
      }

      attendanceBody.push(emptyRow);

      return;
    }

    const status = getStatus(record);

    const row: TableCell[] = [

      formatDate(date, true),

      hasTime(record.timeIn)
        ? record.timeIn
        : '—',

      hasTime(record.timeOut)
        ? record.timeOut
        : '—',

      {
        text:
          hasTime(record.timeIn) &&
          hasTime(record.timeOut)
            ? formatHours(record.minutes)
            : '—',

        alignment: 'center'
      },

      {
        text: status.label,
        color: status.color,
        fontSize: 8.5
      }
    ];

    if (includeRemarks) {

      row.push({
        text: record.remarks?.trim() || '—',
        fontSize: 8,
        color: colors.text
      });
    }

    attendanceBody.push(row);
  };

  // ========================================
  // GENERATE ATTENDANCE ROWS
  // ========================================

  if (includeEmptyDates) {

    const current = new Date(
      `${data.startDate}T12:00:00`
    );

    const end = new Date(
      `${data.endDate}T12:00:00`
    );

    while (current <= end) {

      const year = current.getFullYear();

      const month = String(
        current.getMonth() + 1
      ).padStart(2, '0');

      const day = String(
        current.getDate()
      ).padStart(2, '0');

      const dateKey =
        `${year}-${month}-${day}`;

      const record = records.find(
        item => item.date === dateKey
      );

      addAttendanceRow(dateKey, record);

      current.setDate(
        current.getDate() + 1
      );
    }

  } else {

    for (const record of records) {
      addAttendanceRow(record.date, record);
    }
  }

  // ========================================
  // EMPTY ATTENDANCE STATE
  // ========================================

  if (attendanceBody.length === 1) {

    const emptyRow: TableCell[] = [
      {
        text: 'No attendance records for the selected period.',
        colSpan: headers.length,
        alignment: 'center',
        color: colors.muted,
        margin: [0, 8, 0, 8]
      }
    ];

    for (let index = 1; index < headers.length; index++) {
      emptyRow.push({});
    }

    attendanceBody.push(emptyRow);
  }

  // ========================================
  // STUDENT INFORMATION FIELD
  // ========================================

  const infoField = (
    label: string,
    value: string
  ): ContentStack => ({

    stack: [

      {
        text: label,
        color: colors.muted,
        fontSize: 8,
        margin: [0, 0, 0, 4]
      },

      {
        text: value || 'Not available',
        color: colors.text,
        fontSize: 10,
        bold: true
      }
    ],

    margin: [5, 5, 5, 6]
  });

  // ========================================
  // STUDENT INFORMATION TABLE
  // ========================================

  const profileBody: TableCell[][] = [

    [
      infoField(
        'Student name',
        data.studentName
      ),

      infoField(
        'Student ID',
        data.studentId
      )
    ],

    [
      infoField(
        'School',
        schoolName
      ),

      infoField(
        'Company / Training establishment',
        data.company
      )
    ]
  ];

  if (data.course || data.supervisorName) {

    profileBody.push([

      infoField(
        'Program',
        data.course || ''
      ),

      infoField(
        'Company supervisor',
        data.supervisorName || ''
      )
    ]);
  }

  profileBody.push([

    {
      ...infoField(
        'Period covered',
        `${formatDate(data.startDate)} - ${formatDate(data.endDate)}`
      ),

      colSpan: 2

    } as TableCell,

    {}
  ]);

  // ========================================
  // ATTENDANCE POLICY NOTE
  // ========================================

  const note =

    'Only synchronized and verified attendance hours ' +
    'are credited toward official OJT completion. ' +

    'Provisional hours are subject to supervisor approval. ' +

    'Incomplete and rejected attendance records are not ' +
    'credited toward official OJT completion. ' +

    'Pending sync records have not yet been uploaded.' +

    (
      data.isCachedData
        ? '\nThis document was generated using locally saved information and may not reflect the latest server records.'
        : ''
    ) +

    (
      data.placementNote?.trim()
        ? `\n${data.placementNote.trim()}`
        : ''
    );

  // ========================================
  // PDF DOCUMENT DEFINITION
  // ========================================

  return {

    pageSize: 'A4',

    pageOrientation: 'portrait',

    pageMargins: [36, 32, 36, 42],

    info: {
      title: 'InternTrack - Daily Time Record',
      author: 'InternTrack',
      subject: 'Internship Attendance Record'
    },

    defaultStyle: {
      font: 'Roboto',
      fontSize: 9,
      color: colors.text
    },

    content: [

      // ====================================
      // INTERNTRACK BRANDING
      // ====================================

      {
        columns: [

          {
            stack: [

              {
                text: [

                  {
                    text: 'Intern',
                    color: colors.blue
                  },

                  {
                    text: 'Track',
                    color: colors.orange
                  }
                ],

                fontSize: 21,
                bold: true
              },

              {
                text: 'Internship Management System',
                fontSize: 8,
                color: colors.muted,
                margin: [0, 3, 0, 0]
              }
            ]
          },

          {
            stack: [

              {
                text: 'INTERNSHIP RECORD',
                color: colors.blue,
                bold: true,
                fontSize: 8,
                alignment: 'right'
              },

              {
                text: 'Attendance documentation',
                color: colors.muted,
                fontSize: 8,
                alignment: 'right',
                margin: [0, 4, 0, 0]
              }
            ]
          }
        ],

        margin: [0, 0, 0, 13]
      },

      // ====================================
      // BRAND ACCENT LINE
      // ====================================

      {
        canvas: [

          {
            type: 'rect',
            x: 0,
            y: 0,
            w: 350,
            h: 3,
            color: colors.blue
          },

          {
            type: 'rect',
            x: 350,
            y: 0,
            w: 115,
            h: 3,
            color: colors.purple
          },

          {
            type: 'rect',
            x: 465,
            y: 0,
            w: 58,
            h: 3,
            color: colors.orange
          }
        ],

        margin: [0, 0, 0, 19]
      },

      // ====================================
      // INSTITUTIONAL HEADER
      // ====================================

      {
        text: schoolName,

        alignment: 'center',

        fontSize: 12,

        bold: true,

        margin: [0, 0, 0, 5]
      },

      {
        text: 'On-the-Job Training Program',

        alignment: 'center',

        fontSize: 9,

        color: colors.muted,

        margin: [0, 0, 0, 13]
      },

      {
        text: 'Daily Time Record',

        alignment: 'center',

        fontSize: 24,

        bold: true,

        color: colors.text,

        margin: [0, 0, 0, 5]
      },

      {
        text: 'Internship Attendance Report',

        alignment: 'center',

        fontSize: 10,

        color: colors.muted,

        margin: [0, 0, 0, 20]
      },

      // ====================================
      // STUDENT INFORMATION
      // ====================================

      {
        text: 'Student information',

        fontSize: 11,

        bold: true,

        margin: [0, 0, 0, 8]
      },

      {
        table: {

          widths: ['*', '*'],

          body: profileBody
        },

        layout: {

          fillColor: () => colors.background,

          hLineWidth: () => 0.5,

          vLineWidth: () => 0.5,

          hLineColor: () => colors.border,

          vLineColor: () => colors.border
        },

        margin: [0, 0, 0, 18]
      },

      // ====================================
      // ATTENDANCE TABLE
      // ====================================

      {
        text: 'Attendance details',

        fontSize: 11,

        bold: true,

        margin: [0, 0, 0, 8]
      },

      {
        table: {

          headerRows: 1,

          widths: includeRemarks

            ? [82, 58, 58, 36, 65, '*']

            : ['*', 69, 69, 44, 80],

          body: attendanceBody,

          dontBreakRows: true
        },

        layout: {

          fillColor: (rowIndex: number) =>

            rowIndex === 0
              ? colors.blue
              : rowIndex % 2 === 0
                ? colors.background
                : colors.white,

          hLineWidth: () => 0.5,

          vLineWidth: () => 0,

          hLineColor: () => colors.border,

          paddingTop: () => 8,

          paddingBottom: () => 8,

          paddingLeft: () =>
            includeRemarks ? 5 : 8,

          paddingRight: () =>
            includeRemarks ? 5 : 8
        },

        margin: [0, 0, 0, 18]
      },

      // ====================================
      // ATTENDANCE POLICY NOTE
      // ====================================

      {
        text: note,

        fontSize: 8,

        color: colors.muted,

        lineHeight: 1.3,

        margin: [0, 0, 0, 24]
      },

      // ====================================
      // SIGNATURE SECTION
      // ====================================

      {
        unbreakable: true,

        stack: [

          {
            columns: [

              // STUDENT SIGNATURE

              {
                width: '*',

                stack: [

                  {
                    text: 'Prepared by:',

                    fontSize: 9,

                    color: colors.muted,

                    alignment: 'center',

                    margin: [0, 0, 0, 28]
                  },

                  {
                    text: '____________________________',

                    alignment: 'center'
                  },

                  {
                    text: data.studentName,

                    bold: true,

                    fontSize: 9,

                    alignment: 'center',

                    margin: [0, 5, 0, 3]
                  },

                  {
                    text: 'Student Intern',

                    fontSize: 8,

                    color: colors.muted,

                    alignment: 'center'
                  },

                  {
                    text: 'Signature over printed name',

                    fontSize: 7.5,

                    color: colors.muted,

                    alignment: 'center',

                    margin: [0, 3, 0, 0]
                  }
                ]
              },

              // SUPERVISOR SIGNATURE

              {
                width: '*',

                stack: [

                  {
                    text: 'For verification by:',

                    fontSize: 9,

                    color: colors.muted,

                    alignment: 'center',

                    margin: [0, 0, 0, 28]
                  },

                  {
                    text: '____________________________',

                    alignment: 'center'
                  },

                  {
                    text:
                      data.supervisorName ||
                      reviewerRole,

                    bold: true,

                    fontSize: 9,

                    alignment: 'center',

                    margin: [0, 5, 0, 3]
                  },

                  {
                    text: data.supervisorName

                      ? reviewerRole

                      : 'Authorized representative',

                    fontSize: 8,

                    color: colors.muted,

                    alignment: 'center'
                  },

                  {
                    text: 'Signature over printed name',

                    fontSize: 7.5,

                    color: colors.muted,

                    alignment: 'center',

                    margin: [0, 3, 0, 0]
                  }
                ]
              }
            ],

            columnGap: 25
          }
        ]
      }
    ],

    // ======================================
    // DOCUMENT FOOTER
    // ======================================

    footer: (
      currentPage: number,
      pageCount: number
    ) => ({

      stack: [

        {
          canvas: [

            {
              type: 'line',

              x1: 0,

              y1: 0,

              x2: 523,

              y2: 0,

              lineWidth: 0.5,

              lineColor: colors.border
            }
          ],

          margin: [0, 0, 0, 8]
        },

        {
          columns: [

            {
              text: 'System-generated by InternTrack',

              fontSize: 8,

              color: colors.muted
            },

            {
              text: `Page ${currentPage} of ${pageCount}`,

              alignment: 'right',

              fontSize: 8,

              color: colors.muted
            }
          ]
        }
      ],

      margin: [36, 0, 36, 0]
    })
  };
}