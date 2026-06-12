import Complaint from '../models/Complaint.js';
import aiService from '../services/aiService.js';
import emailService from '../services/emailService.js';
import {
  generateTrackingId,
  calculateSLADeadline,
  determinePriority
} from '../utils/helpers.js';

/**
 * Lodge a new complaint
 */
export const lodgeComplaint = async (req, res) => {
  try {
    const {
      title,
      description,
      language = 'en',
      location,
      state,
      district,
      imageUrl
    } = req.body;

    // Validation
    if (!title || !description || !state || !district) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: title, description, state, district'
      });
    }

    // Generate tracking ID
    const trackingId = generateTrackingId();

    // Call AI service to analyze complaint
    let aiAnalysis;
    try {
      const aiResult = await aiService.analyzeComplaint(
        `${title}\n${description}`,
        language
      );

      if (!aiResult.success) {
        console.error('AI Analysis failed:', aiResult);
        aiAnalysis = {
          intent: title,
          category: 'Other',
          priority: 'Medium',
          keywords: [],
          confidence: 50,
          rawResponse: aiResult
        };
      } else {
        aiAnalysis = aiResult.data;
      }
    } catch (error) {
      console.error('AI Service Error:', error);
      aiAnalysis = {
        intent: title,
        category: 'Other',
        priority: 'Medium',
        keywords: [],
        confidence: 50,
        error: error.message
      };
    }

    // Determine if manual review is needed
    const needsManualReview = aiAnalysis.confidence < 75;

    // Create complaint object
    const complaint = new Complaint({
      user: req.user._id,
      trackingId,
      title,
      description,
      language,
      location: location || undefined,
      state,
      district,
      imageUrl,
      
      // AI Analysis
      aiAnalysis: {
        intent: aiAnalysis.intent,
        category: aiAnalysis.category,
        keywords: aiAnalysis.keywords,
        confidence: aiAnalysis.confidence,
        rawResponse: aiAnalysis.rawResponse
      },
      
      // Smart Routing
      department: aiAnalysis.category || 'Other',
      priority: aiAnalysis.priority || 'Medium',
      priorityReason: aiAnalysis.priorityReason || 'Standard processing',
      routingConfidence: aiAnalysis.confidence,
      needsManualReview,
      manualReviewReason: needsManualReview ? 'Low confidence AI classification' : undefined,
      
      // SLA
      expectedResolutionDate: calculateSLADeadline(aiAnalysis.priority || 'Medium'),
      
      // Initial status
      status: needsManualReview ? 'Under Review' : 'Assigned',
      
      // Action log
      actionLog: [{
        action: needsManualReview ? 'Created' : 'Assigned',
        remarks: needsManualReview ? 'Awaiting manual review' : 'Auto-assigned by AI',
        timestamp: new Date()
      }]
    });

    await complaint.save();

    // Send confirmation email
    try {
      await emailService.sendComplaintConfirmation(
        req.user.email,
        trackingId,
        {
          name: req.user.name,
          department: complaint.department,
          priority: complaint.priority,
          expectedResolution: complaint.priority === 'High' ? '24-48 hours' :
                             complaint.priority === 'Medium' ? '48-72 hours' :
                             'Normal queue'
        }
      );
    } catch (error) {
      console.error('Failed to send confirmation email:', error);
    }

    return res.status(201).json({
      success: true,
      message: 'Complaint lodged successfully',
      complaint: {
        trackingId: complaint.trackingId,
        status: complaint.status,
        department: complaint.department,
        priority: complaint.priority,
        expectedResolutionDate: complaint.expectedResolutionDate,
        needsManualReview: complaint.needsManualReview,
        aiAnalysis: {
          confidence: complaint.aiAnalysis.confidence,
          keywords: complaint.aiAnalysis.keywords
        }
      }
    });
  } catch (error) {
    console.error('Lodge Complaint Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error lodging complaint: ' + error.message
    });
  }
};

/**
 * Get complaint by tracking ID
 */
export const getComplaintByTrackingId = async (req, res) => {
  try {
    const { trackingId } = req.params;

    const complaint = await Complaint.findOne({ trackingId })
      .populate('user', 'name email mobile')
      .lean();

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    return res.status(200).json({
      success: true,
      complaint
    });
  } catch (error) {
    console.error('Get Complaint Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching complaint: ' + error.message
    });
  }
};

/**
 * Get my complaints (user's complaints)
 */
export const getMyComplaints = async (req, res) => {
  try {
    const { status, priority, page = 1, limit = 10 } = req.query;

    const filter = { user: req.user._id };
    if (status) filter.status = status;
    if (priority) filter.priority = priority;

    const complaints = await Complaint.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('trackingId title status priority department expectedResolutionDate createdAt')
      .lean();

    const total = await Complaint.countDocuments(filter);

    return res.status(200).json({
      success: true,
      complaints,
      pagination: {
        current: page,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get My Complaints Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching complaints: ' + error.message
    });
  }
};

/**
 * Get complaint tracking status
 */
export const getComplaintStatus = async (req, res) => {
  try {
    const { trackingId } = req.params;

    const complaint = await Complaint.findOne({ trackingId })
      .lean();

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    return res.status(200).json({
      success: true,
      complaint: {
        trackingId: complaint.trackingId,
        title: complaint.title,
        description: complaint.description,
        status: complaint.status,
        priority: complaint.priority,
        department: complaint.department,
        expectedResolutionDate: complaint.expectedResolutionDate,
        submittedAt: complaint.submittedAt,
        district: complaint.district,
        state: complaint.state,
        citizenMetadata: complaint.citizenMetadata,
        actionLog: complaint.actionLog,
        resolutionDetails: complaint.resolutionDetails,
        resolvedAt: complaint.resolvedAt
      }
    });
  } catch (error) {
    console.error('Get Status Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching status: ' + error.message
    });
  }
};

/**
 * Get complaints pending manual review (admin)
 */
export const getPendingManualReviewComplaints = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const complaints = await Complaint.find({
      needsManualReview: true,
      status: 'Under Review'
    })
      .populate('user', 'name email mobile')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Complaint.countDocuments({
      needsManualReview: true,
      status: 'Under Review'
    });

    return res.status(200).json({
      success: true,
      complaints,
      pagination: {
        current: page,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get Pending Complaints Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching pending complaints: ' + error.message
    });
  }
};

/**
 * Manual review and department assignment
 */
export const assignDepartmentManual = async (req, res) => {
  try {
    const { complaintId } = req.params;
    const { department, priority } = req.body;

    if (!department) {
      return res.status(400).json({
        success: false,
        message: 'Please provide department'
      });
    }

    const complaint = await Complaint.findById(complaintId);

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    complaint.department = department;
    if (priority) complaint.priority = priority;
    complaint.status = 'Assigned';
    complaint.departmentAssignedAt = new Date();
    complaint.needsManualReview = false;

    complaint.actionLog.push({
      action: 'Assigned',
      updatedBy: req.admin._id,
      remarks: `Manually assigned to ${department}`,
      timestamp: new Date()
    });

    await complaint.save();

    // Update SLA if priority changed
    if (priority) {
      complaint.expectedResolutionDate = calculateSLADeadline(priority);
      await complaint.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Department assigned successfully',
      complaint: {
        trackingId: complaint.trackingId,
        department: complaint.department,
        priority: complaint.priority,
        status: complaint.status
      }
    });
  } catch (error) {
    console.error('Assign Department Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error assigning department: ' + error.message
    });
  }
};

/**
 * Update complaint status
 */
export const updateComplaintStatus = async (req, res) => {
  try {
    const { complaintId } = req.params;
    const { status, remarks, resolution } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Please provide status'
      });
    }

    const complaint = await Complaint.findById(complaintId);

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    const oldStatus = complaint.status;
    complaint.status = status;

    if (status === 'Resolved') {
      complaint.resolvedAt = new Date();
      complaint.resolutionDetails = resolution || remarks;
    }

    complaint.actionLog.push({
      action: status,
      updatedBy: req.admin._id,
      remarks: remarks || `Status updated to ${status}`,
      status: status,
      timestamp: new Date()
    });

    await complaint.save();

    // Send status update email
    try {
      const populatedComplaint = await complaint.populate('user');
      const userEmail = populatedComplaint.user.email;
      await emailService.sendStatusUpdate(userEmail, complaint.trackingId, status, remarks);
    } catch (error) {
      console.error('Failed to send status email:', error);
    }

    return res.status(200).json({
      success: true,
      message: 'Status updated successfully',
      complaint: {
        trackingId: complaint.trackingId,
        status: complaint.status,
        resolvedAt: complaint.resolvedAt
      }
    });
  } catch (error) {
    console.error('Update Status Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating status: ' + error.message
    });
  }
};

// Keep old functions for backward compatibility
export const createComplaint = lodgeComplaint;
export const trackComplaint = getComplaintStatus;
export const getComplaints = async (req, res) => {
  return getMyComplaints(req, res);
};