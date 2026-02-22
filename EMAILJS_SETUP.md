# EmailJS Setup Guide

## 1. Create an EmailJS Account

Go to [https://www.emailjs.com/](https://www.emailjs.com/) and sign up (free tier: 200 emails/month).

---

## 2. Connect an Email Service

1. Go to **Email Services** in the dashboard
2. Click **Add New Service**
3. Choose your provider (e.g. Gmail, Outlook, etc.)
4. Follow the prompts to connect your email
5. Copy the **Service ID** (e.g. `service_abc123`)

---

## 3. Create 2 Email Templates

### Template 1: Booking Enquiry

1. Go to **Email Templates** > **Create New Template**
2. Set a name like `booking_enquiry`
3. Use these variables in your template:

| Variable              | Description                        |
|-----------------------|------------------------------------|
| `{{name}}`            | Customer's full name               |
| `{{organization}}`    | Organization / College name        |
| `{{email}}`           | Customer's email address           |
| `{{phone}}`           | Customer's phone number            |
| `{{artist_preference}}`| Preferred artist or genre         |
| `{{event_date}}`      | Event date                         |
| `{{budget}}`          | Approximate budget (optional)      |

**Example template body:**

```
New Booking Enquiry

Name: {{name}}
Organization: {{organization}}
Email: {{email}}
Phone: {{phone}}
Artist/Genre: {{artist_preference}}
Event Date: {{event_date}}
Budget: {{budget}}
```

4. Copy the **Template ID** (e.g. `template_xyz789`)

---

### Template 2: Customer Query

1. Go to **Email Templates** > **Create New Template**
2. Set a name like `customer_query`
3. Use these variables in your template:

| Variable       | Description                     |
|----------------|---------------------------------|
| `{{name}}`     | Customer's full name            |
| `{{email}}`    | Customer's email address        |
| `{{phone}}`    | Customer's phone number         |
| `{{subject}}`  | Query subject/topic             |
| `{{message}}`  | Full message text               |

**Example template body:**

```
New Customer Query

Name: {{name}}
Email: {{email}}
Phone: {{phone}}
Subject: {{subject}}

Message:
{{message}}
```

4. Copy the **Template ID** (e.g. `template_abc456`)

---

## 4. Get Your Public Key

1. Go to **Account** > **General**
2. Copy the **Public Key** (e.g. `user_aBcDeFgHiJk`)

---

## 5. Update the Placeholders in `index.html`

Find and replace these 3 placeholders in `index.html`:

| Placeholder                    | Replace With             | Location in file                  |
|--------------------------------|--------------------------|-----------------------------------|
| `YOUR_PUBLIC_KEY`              | Your EmailJS Public Key  | `<script>` tag in `<head>`        |
| `YOUR_SERVICE_ID`              | Your Email Service ID    | `EMAILJS_SERVICE_ID` variable     |
| `YOUR_BOOKING_TEMPLATE_ID`    | Booking template ID      | `EMAILJS_BOOKING_TEMPLATE_ID`     |
| `YOUR_QUERY_TEMPLATE_ID`      | Query template ID        | `EMAILJS_QUERY_TEMPLATE_ID`       |

---

## Summary

You need to replace **4 values** total:

```
emailjs.init('YOUR_PUBLIC_KEY');

const EMAILJS_SERVICE_ID = 'YOUR_SERVICE_ID';
const EMAILJS_BOOKING_TEMPLATE_ID = 'YOUR_BOOKING_TEMPLATE_ID';
const EMAILJS_QUERY_TEMPLATE_ID = 'YOUR_QUERY_TEMPLATE_ID';
```
